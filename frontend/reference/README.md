# JavaScript

**Great resource to learn beginning or advanced topics:**  
[**https://javascript.info/**](https://javascript.info/)\*\*\*\*

**Check Mozilla prototype reference.**  
[**https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference**/Global\_Objects/Object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)

**TLDR about functional programming:**  
[category-theory-for-programmers](https://bartoszmilewski.com/2014/10/28/category-theory-for-programmers-the-preface/)  
[knowing-monads-through-the-category-theory](https://dev.to/juaneto/knowing-monads-through-the-category-theory-1mea)

What's a Lambda? It's any function that modifies and returns data and does nothing else:  
[https://gist.github.com/ericelliott/414be9be82128443f6df](https://gist.github.com/ericelliott/414be9be82128443f6df)

## Reminder: practice using Generators

Generators I just found out may be even more efficient than for loops. Also, they're very powerful - can be nested - await a generator function inside higher order generator loop. Cool!

## Reminder: use instanceof instead of typeof

```text
let e = new Error('something went wrong')
console.log(typeof e)
// "object"
console.log(e instanceof Error)
// true
```

This also works with any other constructor: Number, Array, Date, etc. which can not be checked using `typeof`. `let d = new Date()` **typeof** returns "object". That's vague! Instead, check using **instanceof** `d instanceof Date` returns true. That's much more specific.

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



