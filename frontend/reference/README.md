# JavaScript

#### **Check Mozilla prototype reference. Have it open when coding or in an interview. Review often.**

* [https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global\_Objects/Object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)

## Reminder: use and practice using Generators

Generators I just found out may be even more efficient than for loops. Also, they're very powerful - can be nested - await a generator function inside higher order generator loop. Cool!

## Reminder: use instanceof instead of typeof

```text
let e = new Error('something went wrong')
console.log(typeof e)
// "object"
console.log(e instanceof Error)
// true
```

This also works with any other constructor: Number, Array, Date, etc. which annoyingly can not be checked using `typeof`. `let d = new Date()` **typeof** returns "object". That's vague! Instead, check using **instanceof**. `d instanceof Date` returns true. That's much more specific.

## Context hack. Reuse the same variable name

Just warp the code in a curly block. This also works to allow variables inside a switch statement. 

```text
{
    let i = 0;
    let key = 'abc'
    // some code here
}
{    
    let i = 0;
    let key = 'xyz'
    // some more code here
}
```



