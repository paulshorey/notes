# ES Modules / Tree Shaking

What's the big deal with CommonJS \(default Node.js modules\) vs ES Modules \(used by Webpack/browsers\) ?? Tree Shaking !!

It's possible with CommonJS, if the module supports it. Like this:

```text
const throttle = require('lodash/throttle')
const debounce = require('lodash/debounce')
```

With ES Modules, it's possible to use a more concise and universal format:

```text
import { throttle, debounce } from 'lodash'
```

Enable this above ES format for Lodash. Lodash does not support it by default:  
[https://github.com/lodash/babel-plugin-lodash](https://github.com/lodash/babel-plugin-lodash)  
Otherwise you'll have to do it the first way, but with import: `import isArray from 'lodash/isArray'`



#### Enable TreeShaking in Webpack:

```text
mode: "production",
optimization: {
    usedExports: true,
},
```

