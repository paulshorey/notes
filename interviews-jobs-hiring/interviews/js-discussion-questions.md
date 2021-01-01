# More advanced

* **What's your favorite and least favorite thing about React \(or whatever framework we're using\).**
* **What's the difference between let/const/var?**
* **What is the difference between arrow functions `()=>{}` and traditional old functions `function() {}`?**  `(()=>{})` is the same as `(function(){}).bind(this)`. Basically, the same context, or `this` keyword is available inside the arrow function, as on the outside of it. **Bad answer:** it's shorter, so is nicer syntax. That's it. **Extra points:** also, arrow functions can return a value without using the return statement: `(str)=>str.trim()`. This makes it even more concise! 
* **What are the benefits of `async/await`? What are its limitations?**  **Benefits:** Similar to `Promise`, but much easier to read and chain. **Limitations:** Blocks execution of rest of code. Runs synchronously. To run multiple operations, asynchronously, have to do `Promise` or `Promise.all`. 
* JavaScript Prototypes. You know, `arr.toString()`, `arr.sort()`, `obj.hasOwnProperty()`, `str.length`... What are some other examples, some from each variable type \(string, number, function, object, array\)?  arr.filter, arr.find, arr.sort, arr.reduce, arr.map, arr.forEach, arr.length set.size, set.add, set.clear, set.delete, set.has obj. 

