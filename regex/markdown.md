# Markdown

**Bold every inline code snippet**

```text
(\s)`([^\n`]+)`
```

```text
$1**`$2`**
```

> This will not match a code snippet if it is the very first character in the file,  
> but at least it will not match code snippets which are already bolded, or multi-line ones  
> This RegEx is for JavaScript and JS IDEs only! Perl examples at bottom.

**Un-bold every inline code snippet**

```text
(\s)**`([^\n`]+)`**
```

```text
$1**`$2`**$3
```

**Make sure each line has exactly two trailing spaces**  
**`([\ ]*?)\n`**  
**`\n`** &lt;- two spaces, backslash, n

## Edit files in Perl

**The above "Bold every inline code snippet" converted to Perl:**

```text
perl -0777pi -e 's/([\s\n]+)`([^\n`]+)`/$1**`$2`**/gm' */*.md;
```

Perl performs this operation to each line by default, ignoring linebreak characters. This "0777" added to -pi, and "m" added to /g, tells Perl to do the operation on the multiple lines of the entire file.

**Also in Perl, "Make sure each line has exactly two trailing spaces":**

```text
perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*.md;
```

