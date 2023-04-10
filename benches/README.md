# webgme-json-importer benchmarks

This section benchmarks the performance of different `webgme-json-importer`
functionalities.

`run-benchmarks` command line utility can be used to run a particular benchmark
(or all benchmarks).

## Usage

from the root of the repository, run the following command:

```shell
benches/run-benchmarks -n applyGuidSubtree # Runs the annotation import benchmark with guids as selectors
```

## Details

```shell
$ benches/run-benchmarks --help
Usage: WJI benchmark [options]

Options:
  -n --benchmark-name <name>  the benchmark to run (choices: "guidSelectors", "applyGuidSubtree", "all", default: "all")
  -h, --help                  display help for command
```
