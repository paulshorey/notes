# Edit Markdown in IDE  
  
**Bold every inline code snippet**  
```  
(\s)`([^\n`]+)`  
```  
```  
$1**`$2`**  
```  
> This will not match a code snippet if it is the very first character in the file,  
but at least it will not match code snippets which are already bolded, or multi-line ones  
> This RegEx is for JavaScript and JS IDEs only! Perl examples at bottom.  
  
**Un-bold every inline code snippet**  
```  
(\s)**`([^\n`]+)`**  
```  
```  
$1**`$2`**$3  
```  
  
**Make sure each line has exactly two trailing spaces**  
```  
([\ ]*?)\n  
```  
```  
  \n  
```  
  
# Edit files in Perl  
  
**The above "Bold every inline code snippet" converted to Perl:**  
```  
perl -0777pi -e 's/([\s\n]+)`([^\n`]+)`/$1**`$2`**/gm' */*.md;  
```  
Perl performs this operation to each line by default, ignoring linebreak characters. This "0777" added to -pi, and "m" added to /g, tells Perl to do the operation on the multiple lines of the entire file.  
  
**Also in Perl, "Make sure each line has exactly two trailing spaces":**  
```  
perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*.md;  
```  
