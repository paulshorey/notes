# RegExp

## **Convert text list into JS object**

Read **left/right of dash**, write as key/value,  
account for more than one type of dash/hyphen  
`\n(.?)\s?[–-]\s?(.?)\n` -&gt; `\n"$1": "$2",\n` 

remove periods, and any spaces before/after  
`\ ?\.\ ?` -&gt; 

remove parentheses \(and content inside parenthesis\) and any spaces before/after  
`\ ?(.*)\ ?` -&gt; 

Use equal sign instead of dash,   
account for previously converted lines \(ignore lines with quotes\)  
`\n([^"]*?)\s?[=]\s?([^"]*?)\n` -&gt; `\n"$1": "$2",\n`  

_**Before parsing entire file, add a linebreak at top and bottom of file.**_  
_**Don't forget to sanitize special character before adding special character \(" double quotes\).**_

## Swap JS object key &lt;-&gt; value





