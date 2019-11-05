# general

[https://javascript.info/regexp-groups](https://javascript.info/regexp-groups) \(nice explanation of grouping using match\)

Reminder: q-mark`?` makes the search "not-greedy". Otherwise `.*` will match the whole line! 

```text
TLD\n?(.*?)\n?(.*?)([0-9]+)
```

There are multiple ways to use RegEx in JavaScript:

```text
/title="(.*?)"/g.exec(str)   // returns arr[0] full str arr[1] inside parentheses
```

```text
str.match(/title="(.*?)"/g)   // returns list of full str matches like arr[0] above
```

```text
/*
 * Iterate over multiple results,
 * get captured group (inside parentheses) of each!
 */
var myString = "one two 3 four";
var myRegexp = /([a-z]+)/g;
match = myRegexp.exec(myString);
while (match != null) {
  console.log(match[0])
  match = myRegexp.exec(myString);
}
```

```text
/*
 * Same as above, but,
 * thank you to ES2020
 */
const string = "one two 3 four";
const regexp = /([a-z]+)/g;
const matches = string.matchAll(regexp);
    
for (const match of matches) {
  console.log(match);
}
```

```text
/([a-z]+)/.test('1235')   // false
```



