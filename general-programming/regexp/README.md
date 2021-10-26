# RegExp

[https://javascript.info/regexp-groups](https://javascript.info/regexp-groups) (nice explanation of grouping using match)

[https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global\_Objects/RegExp/RegExp](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global\_Objects/RegExp/RegExp) (read)

## It's very useful. For example:

Replace all instances of `../../../../functions` no matter how many `../` there are.

**Search: `'([./]+)functions` **

Replace: `src/functions`

## Match including line breaks

`/(.*)/s` - add "s" flag to tell RegExp to NOT stop at the end of the line (which it does by default)&#x20;

## Variables in Regex:

```
let re = new RegExp('(.{0,30})('+input_str+')(.{0,60})','gi')
let found = text.match(re)
```

## Reminders:

Question mark **`?`** makes the search "not-greedy". Otherwise `.*` will match the whole line! **`href="/.? title="(.?)"`**  to find titles of tags which have href

## Use in JavaScript

```
/title="(.*?)"/g.exec(str)   // returns arr[0] full str arr[1] inside parentheses
```

```
str.match(/title="(.*?)"/g)   // returns list of full str matches like arr[0] above
```

```
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

```
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

```
/([a-z]+)/.test('1235')   // false
```
