# quirks

First, here are some quirky benefits which other programming languages wish they had. But it's ok. "Real" programming languages don't know what they're missing, so they'll be fine with their more verbose code.

## Break out of an "if" statement.

Take that "real" programming languages. This is more useful the more you think about it. It can really shorten the code. If you can not "break" out of an if/else statement, then you're forced to wrap the entire inner block of code in another if statement, or the containing block of code in a "for" loop.

```text
namesomething: if (whatever===something) {
    // lots of code
    if (whatever=1) {
        break namesomething
    }
    // lots more code
} else if (somethingElse===somethingOther) {
    // even more code
}
```

