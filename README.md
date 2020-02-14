# Introduction

## Welcome to my Javascript fansite

**A searchable collection of ideas, notes, and code snippets.**  
If I \(or a team mate\) have not used a basic command or code snippet in a while and forgot how to do it, quickly look it up here \(instead of spending time on Google/StackOverflow\).

## To document a "code base", the best solution is probably still [Documentation.JS](https://github.com/documentationjs/documentation/blob/master/docs/GETTING_STARTED.md)

```javascript
    /**  
     * This function adds one to its input.  
     * @param {number} input any number  
     * @returns {number} that number, plus one.  
     */  
    function addOne(input) {  
      return input + 1;  
    }
```

**However, this sort of documentation site is still very useful,** because it can document more than just functions, but entire concepts! I suggest every tech team to use something for general documentation/notes.

Unfortunately, the popular Confluence \(from Atlassian, like Jira\) is so awkward, clunky, buggy, and painful to edit and navigate! GitBook is so much easier to use and navigate! It's like night and day. Just because something is deemed "enterprise level software", doesn't mean it is "good software".

If I can get just one future client to adopt GitBook versus Atlassian's Confluence, then writing this page was worth it!

## About this notes/documentation setup:

**Written in** [**Markdown**](https://dillinger.io/)**, stored on my** [**Github**](https://github.com/paulshorey/notes)**, hosted by** [**GitBook**](https://www.gitbook.com/)**, publicly viewable at** [**notes.paulshorey.com**](https://notes.paulshorey.com)**.**

GitBook does not require you to connect your GitHub repository. It can host your content. **But, you may connect it to your Github "wiki" or "api" or "docs" folder**, and edit your docs from your own IDE/codebase.

Collaborators can edit while they view each document. To save new revision, hit `Cmd + S`. To merge revision to master \(publish your GitBook edit to web\), hit `Cmd + Shift + S`. 

Only takes a second! **Writing documentation is so painless now!**

## Advanced:

You can view/edit GitBook docs on their site. You can also view/edit in your own GitHub repository.

**Note: GitHub.com markdown flavor is dumb.** It ignores linebreaks, except for lines which have **two spaces** on the end. GitBook unfortunately uses the same rule as GitHub, so your notes will look the same on GitBook.com/@yoursite as on GitHub.com/yoursite. **This is not a GitBook issue, but GitHub's.**

I fixed this by using this custom bash function before I commit my code. Your system must support Perl.

```text
# FIX MARKDOWN for GitHub flavor  
 function ghmd() {  
     perl -pi -e 's/[\s]*?\n/\ \ \n/g' *.md;  
     perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*.md;  
     perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*/*.md;  
     perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*/*/*.md;  
     perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*/*/*/*.md;  
     perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*/*/*/*/*.md;  
 }
```

I've been using this for years now, even on clients' codebases, with no detrimental effects, except for an extra few milliseconds lag whenever I commit to GIT.

See [my other CLI shortcuts](http://paulshorey.com/files/.aliases.sh). I have a function to `git add`, `git commit`, and `git push`. But it does some fancy things to make sure I have the latest code and no merge conflicts. Before executing the `commit`, it executes `ghmd` command, to make any and all `.md` files compatible with GitHub.com's custom markdown rule \(add two spaces at the end of every line\).

