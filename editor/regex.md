---
description: >-
  It's useful in backend scripts, but also for searching/replacing code in a
  text editor. Sublime & VsCode are great tools to practice regular expressions
  because they highlight your would-be selections
---

# RegEx for IDEs

**HTML**  
search `(\s*)</script>` replace `</script>` puts all closing tags on same line

`\ ?data-(.*?)"(.*?)"`   
`\ ?tabindex=(".*")`   
 match all tag attributes starting with with or without leading spaces

`li\ class(.*?)"(.*?)"`   
strip out class attribute from matching elements

```text
<!--(.*?)\.(.*?)--> # match comments containing phrase "."
```

search `href="(.*?)"` replace `href=""` clears all href attributes

search `(\ *?)((?!\ ).*?)><span(.*?)</span>`   
replace `$1$2>\n$1  <span$3\n$1  </span>`   
to add indent span elements

Remove all console.logs \(or .warn .error, etc\):  
`(\s?)console.(.?)\n([\w\s\W\t\n]*?)`



