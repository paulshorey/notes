Find all occurrences of *** some word ***, including linebreaks and matches on the same line  
```
\n*(.*)(\*\*\*.*?\*\*\*)(.*)\n*
```

Parse words out of a WordNet dictionary file like `data.adv`  
```
([0-9 ]{2,})([a-zA-Z_]{3,})(.*?)
```
