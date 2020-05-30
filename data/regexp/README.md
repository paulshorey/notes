# RegExp

[https://javascript.info/regexp-groups](https://javascript.info/regexp-groups) \(nice explanation of grouping using match\)

## Reminders:

Question mark **`?`** makes the search "not-greedy". Otherwise `.*` will match the whole line!  
**`href="/.? title="(.?)"`**  to find titles of tags which have href

## Use in JavaScript

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
 * will only be available in ES2020
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

