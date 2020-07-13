# JavaScript

## [Documentation.JS](https://github.com/documentationjs/documentation/blob/master/docs/GETTING_STARTED.md)

```javascript
    /**  
     * This function adds one to its input.  
     * @param {number} input any number  
     * @returns {number} that number, plus one.  
     */  
    function addOne(input) {  
      return input + 1;  
    }
```

It's industry standard, and there is no other competing standard. Most JavaScript libraries use it. Even EcmaScript uses it to document its own methods \(.splice, .length, JSON.stringify, etc\). So if you learn how to use it in your IDE, you can quickly right-click \(or similar shortcut\) to see documentation of a JavaScript prototype, instead of having to open your web browser and find the answer on some website.

My IDE \(IntelliJ WebStorm\) adds syntax coloring to the comment block, and even lints my code against the rules set in the comment block \(warns me when something is not documented, or I'm not following my own documentation, for inputs/outputs\). It also lets me right click a function call from any file, to see its documentation. Very useful. [Read more about IDEs...](../general-programming/ide-1/)

