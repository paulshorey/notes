# Javascript

**Replace all console.logs \(or .warn .error, etc\) with empty line:  
`(\s*)console.(.*)(\s?)`  
`\n`**

**Convert Array Tuple structure to simple Object:**  
`["([\w]+)","(.*?)"],`   
`"$1":"$2",`

**Flip Object key/value:**  
`"(.?)": ?"(.?)",`  
`"$2": "$1",`





