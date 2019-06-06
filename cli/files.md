# Reading/Writing files  
  
**`cat ~/ssh/newssh.pub`** read file text, output to STDOUT  
**`sudo echo "some text" >> /some/file`** write 'text' to bottom of file  
  
> **Mac ONLY:**  
> **`cat ~/ssh/newssh.pub | pbcopy`** read file text into clipboard (Ctrl+C)  
> **`sudo echo $(pbpaste) >> /some/file`** paste copied text to bottom of file  
> This $(pbpaste) seems to avoid having to escape characters which would normally break the CLI command  
  
  
