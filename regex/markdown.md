# Edit Markdown in IDE  
  
**Bold every inline code snippet**  
```  
([\s\n])`([^\n`]*)`([\s\n]?)  
```  
```  
$1**`$2`**$3  
```  
> This will not match a code snippet if it is the very first character in the file,  
but at least it will not match code snippets which are already bolded, or multi-line ones  
> This RegEx is for JavaScript and JS IDEs only! Perl examples at bottom.  
  
**Un-bold every inline code snippet**  
```  
([\s\n])\*\***`([^\n`**]*)`\*\*([\s\n])  
```  
```  
$1**`$2`**$3  
```  
  
**Remove whitespace between the left of bold stars until the first character**  
```  
\*\*\s?([^\s])  
```  
```  
**$1  
```  