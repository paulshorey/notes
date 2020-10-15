# JS Without Semicolons

#### Level: Expert

There are an increasing number of people who write JavaScript without trailing semicolons. I am now one of those weirdos. It is more efficient. The creator of NPM, and other big names in the industry are gung-ho for this convention. Turns out writing JavaScript without trailing semicolons is much easier and faster! Most of the discussion is about sticking to the existing convention or not. On a client's codebase, I would not go changing such a fundamental convention. I don't care enough to be vocal about it. But, I do enjoy it.

Doing it for a while now, I have only come across one issue with it... If you have some code before an anonymous function wrapped in parentheses, Prettier formatting will break! I imagine this will be fixed very soon, as this convention becomes more mainstream, but it is for now something to be aware of:

```text
// you must put a semicolon after this line:
let something = 'something';

// or at the start of this line:
;(function(){
}())
```

Again with anonymous function:

```text
"use strict"
;(function () {
```

## \*\*\*\*

