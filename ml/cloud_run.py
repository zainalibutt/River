"""Runs a batch of River's ML jobs on one rented spot machine on AWS and brings the results home.

A job is one shell command, run from the repository's root, and the one file it writes. The code
at a commit, the files the jobs read (networks, data) and a manifest go to a private S3 bucket; one
spot machine boots, fetches them through presigned links (it holds no AWS credentials), runs the
jobs side by side, and sends each output back through its own presigned link as soon as the job
finishes. The machine terminates when the jobs are done or when its time limit runs out, whichever
comes first, so it cannot be forgotten. Before launching, the month's spend so far plus this run's
most it could cost must stay under a cap, and no other run may be on. Running it again with the same
job list runs only the outputs still missing, which is how a run picks up after AWS reclaims its
machine. The run's files are deleted from S3 when it ends.

    python ml/cloud_run.py <run name> <jobs.tsv> <out dir> --commit <sha> [--repo <worktree>]
        [--file <local path>=<path under files/> ...] [--env NAME=value ...]
        [--type c7a.16xlarge] [--parallel 64] [--hours 3] [--cap 20] [--dry-run]

jobs.tsv holds one job per line: "<output path, relative to the run>\\t<command>". Commands run
from the repository root with the run's files under ../files and outputs under ../out. Needs a live
`aws sso login --profile river`; presigned links last as long as that session, so a run must end
within it.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError, NoCredentialsError, TokenRetrievalError

PROFILE = "river"
REGION = "eu-west-1"
TAG = "river-run"
NODE = "v24.13.0"
# Where the bucket's name is kept between runs, outside the repository.
STATE = Path(os.environ.get("RIVER_CLOUD_STATE", Path.home() / ".river-cloud"))
AMI_PARAMETER = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"

# The machine's own program: it runs as root at boot and never sees an AWS credential.
BOOT = r"""#!/bin/bash
shutdown -h +__MINUTES__
exec > /var/log/river-run.log 2>&1
set -x
mkdir -p /opt/river && cd /opt/river
curl -sfL --retry 5 -o manifest.json '__MANIFEST__' || shutdown -h now
curl -sfL --retry 5 https://nodejs.org/dist/__NODE__/node-__NODE__-linux-x64.tar.xz | tar -xJ -C /opt
export PATH=/opt/node-__NODE__-linux-x64/bin:$PATH
cat > runner.py <<'PY'
import concurrent.futures, json, os, subprocess, tarfile, urllib.request
m = json.load(open("manifest.json"))
def get(url, path):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    urllib.request.urlretrieve(url, path)
def put(url, data):
    urllib.request.urlopen(urllib.request.Request(url, data=data, method="PUT"), timeout=120)
get(m["code"], "code.tgz")
os.makedirs("repo", exist_ok=True)
tarfile.open("code.tgz").extractall("repo")
for f in m["files"]:
    get(f["url"], os.path.join("files", f["path"]))
env = dict(os.environ, **m["env"])
setup = subprocess.run("npm ci --no-audit --no-fund && npm run build --workspace @river/engine",
                       shell=True, cwd="repo", env=env, capture_output=True)
put(m["setup_log"], setup.stdout[-200000:] + setup.stderr[-200000:])
if setup.returncode != 0:
    put(m["done"], b"setup failed")
    raise SystemExit(1)
def run(job):
    out = os.path.join("out", job["output"])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    done = subprocess.run(job["command"], shell=True, cwd="repo", env=env, capture_output=True)
    put(job["log"], done.stdout[-100000:] + done.stderr[-100000:])
    if done.returncode == 0 and os.path.exists(out):
        put(job["put"], open(out, "rb").read())
with concurrent.futures.ThreadPoolExecutor(max_workers=m["parallel"]) as pool:
    list(pool.map(run, m["jobs"]))
put(m["done"], b"done")
PY
python3 runner.py
shutdown -h now
"""


def session():
    try:
        s = boto3.Session(profile_name=PROFILE, region_name=REGION)
        s.client("sts").get_caller_identity()
        return s
    except (NoCredentialsError, TokenRetrievalError, ClientError) as error:
        raise SystemExit(f"no AWS session ({error}); run: aws sso login --profile {PROFILE}") from None


def month_spend(s) -> float:
    """Month-to-date spend in dollars, as Cost Explorer has it (it lags by up to a day)."""
    today = dt.date.today()
    start = today.replace(day=1)
    end = today + dt.timedelta(days=1)
    ce = s.client("ce", region_name="us-east-1")
    result = ce.get_cost_and_usage(
        TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
        Granularity="MONTHLY",
        Metrics=["UnblendedCost"],
    )
    return sum(float(p["Total"]["UnblendedCost"]["Amount"]) for p in result["ResultsByTime"])


def cheapest(s, instance_type: str) -> tuple[str, float]:
    """The default subnet in the zone with the lowest spot price now, and that price."""
    ec2 = s.client("ec2")
    prices = ec2.describe_spot_price_history(
        InstanceTypes=[instance_type],
        ProductDescriptions=["Linux/UNIX"],
        StartTime=dt.datetime.now(dt.timezone.utc),
    )["SpotPriceHistory"]
    if not prices:
        raise SystemExit(f"no spot price for {instance_type} in {REGION}")
    best = min(prices, key=lambda p: float(p["SpotPrice"]))
    subnets = ec2.describe_subnets(
        Filters=[
            {"Name": "default-for-az", "Values": ["true"]},
            {"Name": "availability-zone", "Values": [best["AvailabilityZone"]]},
        ]
    )["Subnets"]
    if not subnets:
        raise SystemExit(f"no default subnet in {best['AvailabilityZone']}")
    return subnets[0]["SubnetId"], float(best["SpotPrice"])


def running(s) -> list[str]:
    ec2 = s.client("ec2")
    found = ec2.describe_instances(
        Filters=[
            {"Name": "tag-key", "Values": [TAG]},
            {"Name": "instance-state-name", "Values": ["pending", "running", "stopping"]},
        ]
    )
    return [i["InstanceId"] for r in found["Reservations"] for i in r["Instances"]]


def storage(s):
    """S3 through the region's own endpoint: a new bucket's links on the global one redirect for a day."""
    return s.client(
        "s3",
        endpoint_url=f"https://s3.{REGION}.amazonaws.com",
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )


def bucket(s) -> str:
    """The lane's private bucket, made once: no public access, everything gone after seven days."""
    STATE.mkdir(parents=True, exist_ok=True)
    note = STATE / "bucket.txt"
    if note.exists():
        return note.read_text().strip()
    name = f"river-ml-runs-{secrets.token_hex(4)}"
    s3 = storage(s)
    s3.create_bucket(Bucket=name, CreateBucketConfiguration={"LocationConstraint": REGION})
    s3.put_public_access_block(
        Bucket=name,
        PublicAccessBlockConfiguration={
            "BlockPublicAcls": True,
            "IgnorePublicAcls": True,
            "BlockPublicPolicy": True,
            "RestrictPublicBuckets": True,
        },
    )
    s3.put_bucket_lifecycle_configuration(
        Bucket=name,
        LifecycleConfiguration={
            "Rules": [{"ID": "expire", "Status": "Enabled", "Filter": {"Prefix": ""}, "Expiration": {"Days": 7}}]
        },
    )
    note.write_text(name)
    return name


def clear(s3, name: str, prefix: str) -> None:
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=name, Prefix=prefix):
        keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
        if keys:
            s3.delete_objects(Bucket=name, Delete={"Objects": keys})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run")
    parser.add_argument("jobs", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--file", action="append", default=[], help="local path=path on the machine, under files/")
    parser.add_argument("--env", action="append", default=[], help="NAME=value for every job")
    parser.add_argument("--type", default="c7a.16xlarge")
    parser.add_argument("--parallel", type=int, default=64)
    parser.add_argument("--hours", type=float, default=3.0, help="the machine terminates itself after this long")
    parser.add_argument("--cap", type=float, default=20.0, help="dollars this month, this run's most included")
    parser.add_argument("--dry-run", action="store_true", help="everything but the machine, with a round trip through a presigned link")
    args = parser.parse_args()

    jobs = []
    for line in args.jobs.read_text().splitlines():
        if line.strip():
            output, command = line.split("\t", 1)
            if not (args.out / output).exists():
                jobs.append({"output": output, "command": command})
    if not jobs:
        print("every output is already here")
        return
    s = session()
    s3 = storage(s)
    if not args.dry_run and running(s):
        raise SystemExit(f"a run is already on: {running(s)}")
    subnet, price = cheapest(s, args.type)
    most = price * args.hours
    spent = max(0.0, month_spend(s))
    print(f"{len(jobs)} jobs; {args.type} at ${price:.3f}/h, at most ${most:.2f} for {args.hours} h; ${spent:.2f} spent this month")
    if spent + most > args.cap:
        raise SystemExit(f"over the ${args.cap:.0f} cap: ${spent:.2f} spent plus up to ${most:.2f}")

    name = bucket(s)
    prefix = f"{args.run}/"
    def link(method: str, key: str) -> str:
        return s3.generate_presigned_url(
            method, Params={"Bucket": name, "Key": key}, ExpiresIn=int(args.hours * 3600) + 1800
        )

    archive = subprocess.run(
        ["git", "-C", str(args.repo), "archive", "--format=tar.gz", args.commit], capture_output=True, check=True
    ).stdout
    s3.put_object(Bucket=name, Key=prefix + "code.tgz", Body=archive)
    files = []
    for entry in args.file:
        local, remote = entry.split("=", 1)
        s3.upload_file(local, name, prefix + "files/" + remote)
        files.append({"path": remote, "url": link("get_object", prefix + "files/" + remote)})
    manifest = {
        "code": link("get_object", prefix + "code.tgz"),
        "files": files,
        "env": dict(entry.split("=", 1) for entry in args.env),
        "parallel": args.parallel,
        "setup_log": link("put_object", prefix + "logs/setup.log"),
        "done": link("put_object", prefix + "done"),
        "jobs": [
            {
                **job,
                "put": link("put_object", prefix + "out/" + job["output"]),
                "log": link("put_object", prefix + "logs/" + job["output"] + ".log"),
            }
            for job in jobs
        ],
    }
    s3.put_object(Bucket=name, Key=prefix + "manifest.json", Body=json.dumps(manifest).encode())
    boot = (
        BOOT.replace("__MINUTES__", str(int(args.hours * 60)))
        .replace("__MANIFEST__", link("get_object", prefix + "manifest.json"))
        .replace("__NODE__", NODE)
    )

    if args.dry_run:
        urllib.request.urlopen(
            urllib.request.Request(manifest["done"], data=b"round trip", method="PUT"), timeout=60
        )
        back = s3.get_object(Bucket=name, Key=prefix + "done")["Body"].read()
        clear(s3, name, prefix)
        print(f"dry run: bucket {name}, {len(archive)} bytes of code, {len(files)} files, "
              f"boot script {len(boot)} bytes; presigned round trip {'ok' if back == b'round trip' else 'FAILED'}")
        return

    ec2 = s.client("ec2")
    image = s.client("ssm").get_parameter(Name=AMI_PARAMETER)["Parameter"]["Value"]
    instance = ec2.run_instances(
        ImageId=image,
        InstanceType=args.type,
        MinCount=1,
        MaxCount=1,
        SubnetId=subnet,
        UserData=boot,
        InstanceInitiatedShutdownBehavior="terminate",
        InstanceMarketOptions={
            "MarketType": "spot",
            "SpotOptions": {"SpotInstanceType": "one-time", "InstanceInterruptionBehavior": "terminate"},
        },
        BlockDeviceMappings=[
            {"DeviceName": "/dev/xvda", "Ebs": {"VolumeSize": 30, "VolumeType": "gp3", "DeleteOnTermination": True}}
        ],
        MetadataOptions={"HttpTokens": "required"},
        TagSpecifications=[{"ResourceType": "instance", "Tags": [{"Key": TAG, "Value": args.run}]}],
    )["Instances"][0]["InstanceId"]
    print(f"launched {instance}; results arrive in {args.out}")

    started = time.time()
    fetched: set[str] = set()
    while True:
        time.sleep(60)
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=name, Prefix=prefix + "out/"):
            for o in page.get("Contents", []):
                key = o["Key"][len(prefix + "out/") :]
                if key not in fetched:
                    (args.out / key).parent.mkdir(parents=True, exist_ok=True)
                    s3.download_file(name, o["Key"], str(args.out / key))
                    fetched.add(key)
        state = ec2.describe_instances(InstanceIds=[instance])["Reservations"][0]["Instances"][0]["State"]["Name"]
        hours = (time.time() - started) / 3600
        print(f"{dt.datetime.now():%H:%M} {len(fetched)}/{len(jobs)} outputs, machine {state}, {hours:.2f} h, about ${hours * price:.2f}", flush=True)
        finished = s3.list_objects_v2(Bucket=name, Prefix=prefix + "done").get("KeyCount", 0) > 0
        if finished or state in ("shutting-down", "terminated"):
            break
    logs = args.out / "_logs"
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=name, Prefix=prefix + "logs/"):
        for o in page.get("Contents", []):
            target = logs / o["Key"][len(prefix + "logs/") :]
            target.parent.mkdir(parents=True, exist_ok=True)
            s3.download_file(name, o["Key"], str(target))
    clear(s3, name, prefix)
    missing = len(jobs) - len(fetched)
    print(f"ended after {(time.time() - started) / 3600:.2f} h; {missing} outputs missing"
          + ("; run again to finish them" if missing else ""))


if __name__ == "__main__":
    sys.exit(main())
