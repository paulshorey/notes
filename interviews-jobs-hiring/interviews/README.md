# JavaScript quiz

## What's your favorite way to iterate \(loop over\) ...

1\) an array?   `for (let item of arr) { ...` or `arr.forEach((item, i) => { ...`  

2\) an object? `for (let key in obj) { let val = obj[key]; ...` 

3\) a sentence, word by word? `let i = 0; while (i < str.length) { i++; ...`  

## What are the differences between an array an an object ?

Person could say that an array actually is an object. In a way, that is true. Good start. However, if the person stops there, that's a red flag. What actually are the differences?...

## What's your favorite feature from the new ES6 JavaScript, which was not there in the old ES5?

This is a great question for general discussion, chit chat, getting to know each other's preferences and personality... but also, more importantly, it is a test to see if the interviewee has some beginner misconceptions about the features \(less experienced than say they are\). For example, they may say they know ES6+, but then during talking about these features, you find out they don't know what an "arrow function" actually does. Most interviewees in my experience thought that it was only there for shorthand, exactly the same as the regular function. Then, I find out that the person doesn't understand "this" keyword, or context, or even scope. Lol.

* **more direct question:** How is the ES6 "arrow function" different from the original JavaScript function?
* **answer:** It is like doing `function(){}.bind(this)`. It assumes the context of the object/class from where it is called, instead of creating its own.





















