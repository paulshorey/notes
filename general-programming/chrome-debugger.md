# Chrome Debugger

**Ignore REST requests, which you don't care about debugging:**  
In "filter" funnel icon, text field, enter: `-method:OPTIONS -method:GET`   
to filter out any OPTIONS or GET requests  
`method:PUT` to see only PUT requests

**Ignore script files, which you don't care about debugging:**  
Chrome black-boxing supports regular express for the file name. Simply use the a Negative Lookahead `(?!your script)`.  
eg. `^((?!myscript).)*$` will blackboxing any other script except myscript

**Other good stuff:**  
[https://raygun.com/javascript-debugging-tips](https://raygun.com/javascript-debugging-tips)







