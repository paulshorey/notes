# Edit Markdown in IDE  
  
**Bold every inline code snippet**  
```  
([\s\n])**`([^\n`**]*)`([\s\n]?)  
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
  
  
  
# Perl (oldschool, command line tool)  
work differently than in Javascript and Electron based IDEs.  
```  
perl -pi -e 's/[\s]*?\n/\ \ \n/g' *.md; # add trailing spaces for GitHub  
perl -pi -e 's/**`([^`**]+)**`/**`**$1`**/g' *.md; # bold all inline code snippets!  
perl -pi -e 's/\*\*\*\*/**/g' *.md; # bugfix: quadruple asterisk created by last line,  
# perl does not work well for linebreaks  
```