---
description: 'Use PM2: https://pm2.keymetrics.io/docs/usage/quick-start/'
---

# Node JS

Download NodeJS package \(pkg\) for Mac \(easiest way to install Node\):  
[https://nodejs.org/dist/](https://nodejs.org/dist/)

ES Module files can use `await` outside of an `async` function. But this causes incompatibility with CJS! Good read:  
[https://redfin.engineering/node-modules-at-war-why-commonjs-and-es-modules-cant-get-along-9617135eeca1](https://redfin.engineering/node-modules-at-war-why-commonjs-and-es-modules-cant-get-along-9617135eeca1)

## Important note:

`process.env.PWD` is the working directory when the _process was started_. This stays the same for the entire process.

`process.cwd()` is the _current_ working directory. It reflects changes made via `process.chdir()`.

## What node processes running?

`ps cax | grep node;` returns process IDs  
`kill 1234` kill process by ID

`killall node` kill all node processes

Even better, use "PM2" to manage node processes!

## Quirks

Sometimes, **Promise.all** and **Promise.race** do not like to run in parallel as they're supposed to! It depends on the types of functions in the requests array. 

You may need to fix it by putting in a wrapper async/await function which calls each promise. The returning function `fnctn` is already async, but that doesn't count. It has to be an additional wrapper function, as you see here, an anonymous one inside `requests.map`. I read that a `setTimeout` or `setInstant` might also work, but didn't care to try it, because async/await solution is simpler.

```text
let requests = []
requests.push(bing_autosuggest)
requests.push(bing_spellcheck)
//
let response = await Promise.all(
  requests.map(async (fnctn) => {
    await fnctn(string, options)
  })
)
```

This has something to do with "workers" or "worker pool queue". It allows Node.js to send out multiple workers, on multiple threads, or something like that. It is "non-blocking". The server may need to have multiple CPUs for this to work well. Not sure. Need to read more about it:

Workers, pool, queues:  
[https://nodejs.org/en/docs/guides/dont-block-the-event-loop/](https://nodejs.org/en/docs/guides/dont-block-the-event-loop/)

Blocking vs non-blocking operations:  
[https://nodejs.org/en/docs/guides/blocking-vs-non-blocking/](https://nodejs.org/en/docs/guides/blocking-vs-non-blocking/)

setImmediate vs setTimeout:  
[https://snyk.io/blog/nodejs-how-even-quick-async-functions-can-block-the-event-loop-starve-io/](https://snyk.io/blog/nodejs-how-even-quick-async-functions-can-block-the-event-loop-starve-io/)

Worker threads:  
[https://nodesource.com/blog/worker-threads-nodejs/](https://nodesource.com/blog/worker-threads-nodejs/)

More of the same:  
[http://sebastianmetzger.com/handle-asynchronous-non-blocking-io-in-javascript/](http://sebastianmetzger.com/handle-asynchronous-non-blocking-io-in-javascript/)  




Not related, but also good read about architecture:  
[https://levelup.gitconnected.com/layers-in-software-architecture-that-every-sofware-architect-should-know-76b2452b9d9a](https://levelup.gitconnected.com/layers-in-software-architecture-that-every-sofware-architect-should-know-76b2452b9d9a)











