# Text

Find all occurrences of  _**some word**_ , including linebreaks and matches on the same line

```text
\n*(.*)(\*\*\*.*?\*\*\*)(.*)\n*
```

Parse words out of a WordNet dictionary file like `data.adv`

```text
([0-9 ]{2,})([a-zA-Z_]{3,})(.*?)
```

