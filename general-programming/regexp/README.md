# RegExp

## **Convert text list into JS object**

Read **left/right of dash**, write as key/value,  
account for more than one type of dash/hyphen  
`\n(.?)\s?[–-]\s?(.?)\n` -&gt; `\n"$1": "$2",\n` 

remove periods, and any spaces before/after  
`\ ?\.\ ?` -&gt; 

remove parentheses \(and content inside parenthesis\) and any spaces before/after  
`\s?((.*))\s?` -&gt; 

Use equal sign instead of dash,   
account for previously converted lines \(ignore lines with quotes\)  
`\n([^"]*?)\s?[=]\s?([^"]*?)\n` -&gt; `\n"$1": "$2",\n`  

Remove long descriptive phrases, 30+ characters in a row, which contain only words and spaces  
`,[a-zA-Z0-9 ]{30,}`  -&gt;

_**Before parsing entire file, add a linebreak at top and bottom of file.**_  
_**Don't forget to sanitize special character before adding special character \(double quotes\).**_

## Swap JS object key &lt;-&gt; value





