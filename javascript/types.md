# types

description: &gt;-  
Use Typescript and prop types, BUT, do also get comfortable with the "types"  
of variables in JavaScript, and how to switch between them. Life will be

### easier.

## Type safety

Javascript is easy! It's a very loosely-typed language. You don't need to declare how long an array is before you assign it to a variable. No need to specify how many bytes a string is going to be. Memory allocation is automated. Programming can be fun and creative!

But it can make people lazy and sloppy. Beginners may not understand the pitfalls of assigning and passing variables with wrong types. Mid-level programmers may become complacent and cut corners.

This is why tools such as Typescript are often a mandate. Using it is wise. But, if it is not possible, or will be too troublesome to install, we can at least be aware of variable types, and "drive defensively"...

#### Convert to number:

```text
var two = "2";  

// Best (easiest for others to read):
    Number('1') // 1

// Works:  
    +two // add a plus sign before the  
    two | 0 // even better, add a default value  
    undefined | 0 // returns 0  
    null | 0 // returns 0  
    true | 0 // returns 1  

// Error:  
    Using 'one' instead of '1' with any of these methods, yields NaN
```

#### Convert to string:

```text
var three = 3;  
var arr = [3,2,1];  

// Works:  
    three +"" // add a string to anything to make it a string  
    arr +"" // returns string "3,2,1"  
    [] +"" // returns empty string  
    undefined || "" // returns empty string  
    three+"" || "default value" // even better
```

The following are not for type "safety", but only for consciously converting one to another:

#### Convert to array:

```text
var obj = {first:"stuff", second:"more stuff"};  

// Works:  
    Object.keys(obj) // returns array of keys  
    Object.values(obj) // array of values  
    Object.entries(obj) // array of arrays [ key, value ]  

// Works with strings too!  
    Object.values("hi") // ['h','i']
```

#### Convert to object:

```text
Object.assign({}, ["h","i"]) // {0:'h', 1:'i'}
```

#### **Shallow copy object:**

```text
Object.assign({}, someObject) // shallow copy  
{...someObject} // shallow copy in ES6
```

But wait, there's more! ES6 also has new Set\(\) and new Map\(\) which are \(like Array\) also objects. Like all objects, they are assigned by reference! And more, they can not even be shallow-copied using Object.assign or spread operator.

#### Deep copy \(immutably, without assigning anything by reference\):

```text
/* Currently only 2 layers deep! Refactored version coming soon,  
will be recursive */  
/* Caution! Functions will still be passed by reference! */  

window.deepCopy = function(state) {  
  var newState = {};  
  for (let prop in state) {  
    let value = state[prop];  
    if (typeof value === "object") {  

      // copy Set  
      if (value instanceof Set) {  
        newState[prop] = new Set([...value]);  

      // copy Map*** (***untested!)  
      if (value instanceof Map) {  
        newState[prop] = new Map([...value]);  

      // copy Array  
      } else if (value instanceof Array) {  
        newState[prop] = [...value];  

      // copy Object  
      } else {  
        newState[prop] = { ...value };  
      }  
    } else {  

      // copy Number, String, Boolean, Function  
      newState[prop] = value;  
    }  
  }  
  return newState;  
};
```

