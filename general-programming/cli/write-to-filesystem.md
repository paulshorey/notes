# Write to filesystem

Append text to end of file:  
`echo "my text" >> filename`  

Replace specific line starting with text:  
`sed -i "s/hostname = .*/hostname = $(hostname)/" /etc/logdna.conf`   
\(the `-i` flag tells it to edit the original file\) 





