# HTML

Lets find all link title attributes in an html page:

```text

```

select link text of every anchor tag \(of &gt; 5 characters, so no "edit" or "\[1\]" links\)

```text
(.*?)<a(.*?)>(.{5,}?)</a>(.*?)
```

put all closing tags on same line  
**`(\s*)</script>`**  
**`</script>`**

match all tag attributes starting with with or without leading spaces  
**`\ ?data-(.*?)"(.*?)"`**  
**`\ ?tabindex=(".*")`**

strip out class attribute from matching elements  
**`li\ class(.*?)"(.*?)"`**

find comments containing period "."  
**`<!--(.*?)\.(.*?)-->`**

clear all href attributes  
**`href="(.*?)"`**  
**`href=""`**

add indent span elements  
**`(\ *?)((?!\ ).*?)><span(.*?)</span>`**  
**`$1$2>\n$1 <span$3\n$1 </span>`**

