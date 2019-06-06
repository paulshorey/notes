# Edit Javascript in IDE:  
  
Replace all console.logs (or .warn .error, etc):  
**`(\s*)console.(.*)(\s?)`**  
**`\n`**  
> This removes the entire line, and assumes every statement is on its own line!  
  
  
  
