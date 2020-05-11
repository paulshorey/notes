# url params



```text
/**
 * Trim a character other than whitespace
 * @param s {string} - string
 * @param c {string} - remove this character (or characters) from start/end
 * @returns {void | string | never}
 */
function trim(s, c) {
  if (c === "]") c = "\\]";
  if (c === "\\") c = "\\\\";
  return s.replace(new RegExp(
    "^[" + c + "]+|[" + c + "]+$", "g"
  ), "");
}

/**
 * Change a url (GET) parameter in queryString string
 * @param queryString {string} - ex: "?wellId=4&resolution=formation"
 * @param key {string} - ex: "resolution"
 * @param value {string} - ex: "subunit"
 * @return {string} - ex: "?wellId=4&resolution=subunit"
 */
function queryStringReplaceKeyValue(queryString, key, value) {
  // clean input
  queryString = trim(queryString, '&');
  queryString = trim(queryString, '?');
  let obj = JSON.parse('{"' + decodeURI(queryString).replace(/"/g, '\\"').replace(/&/g, '","').replace(/=/g, '":"') + '"}');
  // replace value
  obj[key] = value;
  // rebuild queryString with replaced value
  let output = '?';
  for (let pair of Object.entries(obj)) {
    output += pair[0] + '=';
    output += pair[1] + '&';
  }
  return trim(output, '&');
}
```



