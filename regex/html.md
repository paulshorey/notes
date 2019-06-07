# HTML examples  
  
put all closing tags on same line  
**`(\s*)</script>`**  
**`</script>`**  
or  
**`(\s*)</([a-zA-Z]+)>`**  
**`</$2>`**  
  
match all tag attributes starting with with or without leading spaces  
**`\ ?data-(.*?)"(.*?)" `**  
**`\ ?tabindex=(".*") `**  
  
strip out class attribute from matching elements  
**`li\ class(.*?)"(.*?)" `**  
  
find comments containing period "."  
**`<!--(.*?)\.(.*?)-->`**  
  
clear all href attributes  
**`href="(.*?)"`**  
**`href=""`**  
  
add indent span elements  
**`(\ *?)((?!\ ).*?)><span(.*?)</span> `**  
**`$1$2>\n$1  <span$3\n$1  </span> `**  
  
  
