#!/usr/bin/env -S node --loader ts-node/esm --disable-warning=ExperimentalWarning --disable-warning=DEP0180

import {execute} from '@oclif/core'

await execute({development: true, dir: import.meta.url})
