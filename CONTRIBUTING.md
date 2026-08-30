## Contributing

[fork]: /fork
[pr]: /compare
[style]: https://standardjs.com/

Hi there! I am thrilled that you'd like to contribute to this project. Your help is essential for keeping it great.

## Setting up the environment

1. [Fork][fork] and clone the repository.
1. Configure and install the dependencies: `npm install` (you need to have node.js installed, I use v14.17.4).
1. Run the project with `npm run start`

The project is built using Angular 9 and NgRx 10. Check the official guides if you need help.

To edit the data ([i18n](./i18n) or the [Wingspan card list](./scripts/transform/wingspan-card-list.xlsx)), python is required to transform it to the json files. Install the dependencies with `python3 -m pip install -r scripts/requirements.txt`, then run the notebook for the data you changed:

```bash
scripts/transform/run.py json-transformer   # card list
scripts/transform/run.py language-to-json   # i18n
```

They write straight into [src/assets/data](./src/assets/data/) — commit that JSON alongside the spreadsheet change. Open the notebooks in Jupyter instead if you would rather step through them. See [scripts/README.md](./scripts/README.md) for what else lives there.

## Submit a pull request
1. Make your change, add tests, and make sure the tests still pass.
1. Make sure to test the app locally.
1. Create a new branch: `git checkout -b my-branch-name`.
1. Push to your fork and [submit a pull request][pr].
1. Pat your self on the back and wait for your pull request to be reviewed and merged.
