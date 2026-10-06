# ml

Training for v9's value networks, which let the bots solve the turn and flop the way v8z solves the river. The plan and its measurements are in [docs/bots.md](../docs/bots.md).

The data comes from the TypeScript side: `apps/server/src/bot-river-value-data-run.ts` solves random rivers with the bots' own river solver and writes them as fixed-size records. Python only trains; nothing here runs on the server, which reads the exported weights itself.

- `river_value_data.py` reads a run's records into numpy arrays, after checking its `manifest.json` describes the layout this reader expects.
- `train_river_value.py` trains the river network on a GPU and exports its weights as little-endian float32, described by a JSON file.

```
python -m pip install -r ml/requirements.txt   # see the file for PyTorch's CUDA index
python ml/train_river_value.py <data dir> <out dir> --epochs 40
```
