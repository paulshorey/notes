# JavaScript

## [⚠️](https://emojipedia.org/warning/) Quirks and Gotchas! [⚠️](https://emojipedia.org/warning/)

### **JS Without Semicolons  \(level: expert\)**

There are an increasing number of people who write JavaScript without trailing semicolons. I am now one of those weirdos. It is more efficient. The creator of NPM, and other big names in the industry are gung-ho this new convention. Turns out writing JavaScript without trailing semicolons is much easier and faster! Most of the discussion is about sticking to the existing convention or not. On a client's codebase, I would not go changing such a fundamental convention. I don't care enough to be vocal about it. But, I do enjoy it.

Doing it for a while now, I have only come across one issue with it... If you have some code before an anonymous function wrapped in parentheses, Prettier formatting will break! I imagine this will be fixed very soon, as this convention becomes more mainstream, but it is for now something to be aware of.

```text
// you must put a semicolon after this line:
let something = 'something';

// or at the start of this line:
;(function(){
}())

// or, Prettier will get confused!
```

**Level: Beginner, FullStack**  
The first paragraph brings up another interesting quirk and gotcha -- the global variable. In the browser, you have the variable `window`, properties of which are available in all included script files, without even mentioning "window.myVar". In Node.JS, you have actually two \(at least\): `process` and `global`. Process contains system properties like `process.env`, `process.exit`, etc., similar to the browser `window.location`, `window.screen`, etc. Discussion on whether or not to set your own custom properties directly onto window, or global, or process, is another topic -- covered in "anti-patterns".



