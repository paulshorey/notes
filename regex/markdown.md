# Edit Markdown in IDE  
  
Bold every inline code snippet  
```  
([\s\n])`([^\n`]*)`([\s\n])  
```  
```  
$1**`$2`**$3  
```  
  
Un-bold every inline code snippet  
```  
([\s\n])\*\*`([^\n`]*)`\*\*([\s\n])  
```  
```  
$1`$2`$3  
```  
  
Remove whitespace between the left of bold stars until the first character  
`\*\*\s?([^\s])`  
`**$1`  