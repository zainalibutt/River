# ml

Training for v9's value networks, which let the bots solve the turn and flop the way v8z solves the river. The plan and its measurements are in [docs/bots.md](../docs/bots.md).

The data comes from the TypeScript side: `apps/server/src/bot-river-value-data-run.ts` solves random rivers with the bots' own river solver and writes them as fixed-size records. Python only trains; nothing here runs on the server, which reads the exported weights itself.

- `river_value_data.py` reads a run's records into numpy arrays, after checking its `manifest.json` describes the layout this reader expects.
- `train_river_value.py` trains the river network on a GPU and exports its weights as little-endian float32, described by a JSON file.

```
python -m pip install -r ml/requirements.txt   # see the file for PyTorch's CUDA index
python ml/train_river_value.py <data dir> <out dir> --epochs 40
```

## Turn-start targets

`bot-turn-start-data-run.ts` samples the same boards, pots, stacks and ranges as the
turn-end factory, then solves the full live turn tree (100 iterations). Choose the
leaf teacher explicitly; model stems name `.json`/`.bin` exports:

```
npx tsx apps/server/src/bot-turn-start-data-run.ts <out> <seed> <worker> <shards> <spots-per-shard> turn-end <turn-end-model-stem>
npx tsx apps/server/src/bot-turn-start-data-run.ts <out> <seed> <worker> <shards> <spots-per-shard> per-river <river-model-stem>
```

Omit the stem (or pass `-`) to use `RIVER_TURN_NETWORK` / `RIVER_RIVER_NETWORK`.
An optional final argument sets a stop deadline in epoch milliseconds. A `STOP`
file in the output directory also stops between spots; unfinished shards are
discarded and replayed from the same seeds on restart. Completed
`turnstart-wNN-NNNNN.bin` shards are skipped; changing the manifest configuration
requires another output directory. Run only one process per worker index.

Records retain the 23,900-byte little-endian river layout, expected-strength ranks,
normalized range rows and values in pots by `comboIndex52`. Board byte 4 is 255.
Former padding byte 5 is the target: 1 = `turn-start/turn-end-v1`,
2 = `turn-start/per-river-v1`; legacy end-of-street records have zero. The manifest
also records the target, teacher, model stem, sampling settings and turn tree.
Use separate directories for each teacher. `river_value_data.py` and
`train_river_buckets.py` validate target bytes and reject mixed turn-start targets;
the trainer preserves the target in its model JSON. Training uses the existing
`python ml/train_river_buckets.py <data-dir> <model-out>` command.

With NumPy installed, smoke-check three or more generated spots per teacher using
`python ml/smoke_turn_start_data.py <turn-end-dir> <per-river-dir>`.
