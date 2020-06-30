# Chrome Debugger

## **Ignore REST requests, which you don't care about debugging:**

In "filter" funnel icon, text field, enter: `-method:OPTIONS -method:GET`   
to filter out any OPTIONS or GET requests  
`method:PUT` to see only PUT requests

## **Ignore script files, which you don't care about debugging:**

Chrome black-boxing supports regular expressions to "black-list" a file or folder. But, if you're too lazy to make a regex for every 3rd party framework, including NodeJS internals, then use the a Negative Lookahead:  
`^((?! regex to whitelist your scripts go here ).)*$`   
**Ex:   
`^((?!nlp-be).)*$` will blacklist \(blackbox\) any scripts that are NOT in the `nlp-be` folder.**

## **Debug Node.JS**

1\) Instead of running `node myApp.js`, run `node --inspect myApp.js`  
Optionally, specify the port `node --inspect=0.0.0.0:9229 myApp.js`

2\) Open `chrome://inspect/#devices` in Chrome web browser.  
This works when running locally and remotely! :D

## Pro tip:

I use Opera web browser to browse and debug front-end code, and Chrome to debug \(inspect\) backend code. Or, use Chrome for FE and Opera for BE. Point is, this works great, to keep different settings \(blackboxing\) for each environment, and to open the right debugger for each environment. Sharing the same debugger for front and back ends is too cumbersome!

## **Launch automatically from WebStorm IDE**

Click  "run -&gt; debug",  but first, must configure it with "run -&gt; edit configurations...". There, setup "browser" "after launch". For NodeJS process, I auto-open "devtools://devtools/bundled/inspector.html". Then, using Chrome extension "Node.js V8 --inspector Manager \(NiM\)", this opens up the NodeJS inspector devtool immediately, every time I start a Node process from the IDE.

## **Etc:**

**How to step through code:**  
[https://developers.google.com/web/tools/chrome-devtools/javascript/step-code](https://developers.google.com/web/tools/chrome-devtools/javascript/step-code)

**Other good stuff:**  
[https://raygun.com/javascript-debugging-tips](https://raygun.com/javascript-debugging-tips)

