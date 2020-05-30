# RegExp

**Convert text into JS object**

Read **left/right of dash**, write as key/value  
`\n(.?)\s?[–-]\s?(.)\n` -&gt; `\n"$1": "$2",\n` 

remove periods, and any spaces before/after  
`\ ?\.\ ?` -&gt; 

remove parentheses \(and content inside parenthesis\) and any spaces before/after  
`\ ?(.*)\ ?` -&gt; 

Use equal sign instead of dash,  
account for previously converted lines \(ignore lines with quotes\)  
`\n([^"]*?)\s?[=]\s?([^"]*)\n` -&gt; `\n"$1": "$2",\n` 







