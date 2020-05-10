---
description: >-
  How to make this collaborative? Set up an organization, $32/mo. Todo when I
  have more devs.
---

# Document everything!

**This is a searchable collection of ideas, notes, and code snippets...**  
Instead of searching on Google or StackOverflow, if I remember that I've deal with an issue in the past \(and recently have been writing them down\), then I just search here and get exactly what I need. Still brainstorming how to make this more collaborative - but then that is what StackOverflow is for. This GitBook platform is really excellent for teams. When I have other programmers in my team, I can upgrade this to a collaborative environment. Have already done it with my partner and wife - not for programming, but for linguistic stuff - and it worked great! Collaborating on this thing is great! And taking notes on it is great too!

## To document a code base, consider [Documentation.JS](https://github.com/documentationjs/documentation/blob/master/docs/GETTING_STARTED.md)

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

My IDE \(IntelliJ WebStorm\) even adds syntax coloring to the comment block, and then lints my code against the rules set in the comment block. It also lets me right click a function call from any file, to see its documentation. Very useful. [Read more about IDEs...](general-programming/ide-1/)

## GitBook

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

