# Chrome Debugger

## **Ignore REST requests, which you don't care about debugging:**

In "filter" funnel icon, text field, enter: `-method:OPTIONS -method:GET`   
to filter out any OPTIONS or GET requests  
`method:PUT` to see only PUT requests

## **Ignore script files, which you don't care about debugging:**

Chrome black-boxing supports regular express for the file name. Simply use the a Negative Lookahead `^((?! regex to whitelist your scripts go here ).)*$`.  
**Ex: `^((?!name/api).)*$` will blackboxing any scripts that are not in the `name/api` folder.**

\*\*\*\*

**How to step through code:**  
[https://developers.google.com/web/tools/chrome-devtools/javascript/step-code](https://developers.google.com/web/tools/chrome-devtools/javascript/step-code)

**Other good stuff:**  
[https://raygun.com/javascript-debugging-tips](https://raygun.com/javascript-debugging-tips)







