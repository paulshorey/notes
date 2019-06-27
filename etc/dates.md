---
description: All about Dates on the World Wide Web
---

# Dates: UTC/ISO/GMT/Local time

**Local time =**   
the time in your time zone, in am/pm or 24hr format, doesn't matter,   
**Always includes the timezone**, which is just offset \(+ or -\) number of hours from GMT

```text
const now = new Date()

// Thu Jun 27 2019 10:37:12 GMT-0700 (Pacific Daylight Time)
// ^ Current time in California (where I am typing)
```

**GMT =**   
Also local time, but in the Greenwich Mean Time \(GMT\) timezone \(time in England\). **Includes timezone, because this is local time.** It is simply local time in a specific timezone.

```text
function visualizeUTC_asLocalTime(date) {
 // receives and returns Date object 
 return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds());  
} 
visualizeUTC_asLocalTime(now);

// Thu Jun 27 2019 17:37:12 GMT-0700 (Pacific Daylight Time)
// ^ Notice, this is 7 hours ahead (time in England)
```

~~**UTC =**~~   
~~your Local time converted to GMT.  
**No time zone information. Same as GMT, but without the timezone.**~~  
By "UTC", people generally mean "standard world time with no timezones" \(ISO format string\).

```text
// There is no way to represent UTC other than as an ISO string.
// In JS, the Date() object always uses your local timezone.
```

**ISO =**   
UTC time represented as a string, in a specific format.  
Allows us to represent and share dates across the world, without having to convert between timezones.  
**This is very important: There is no such thing as a UTC format or data structure, except for ISO string. When you do `.toISOString()`, JavaScript converts your Local time to UTC time.**

```text
now.toISOString();

"2019-06-27T17:37:12.699Z"
```

ISO string follows "RFC 3339" standard.   
"T" in the middle is optionally replaced by a space " ".  
"Z" at the end is also optional, denotes UTC time. Leave it out to convert to local time!

-----------------------------------------------------

### Use case \#1 ~ Allow users from multiple time-zones to edit the same date.

No problem. This is what Local time was made to do. It makes the "world time", or UTC/ISO appear relative to the user's location. When it is stored in the DB/API, it is converted back to UTC "world time".

**Back-end:** store date in UTC \(ISO\) in database.  
**Front-end:** view date in Local time, allow user to edit the Local time. Convert back to UTC \(ISO\) before sending to the back-end. \(This is done automatically when JavaScript converts to ISO string\)

```text
// get from server
const dateFromAPI = "2019-06-27T17:37:12.699Z";
const date = new Date(dateFromAPI);

// send back to server
const postData = {
    date: date.toISOString()
}
```

No effort!  
Getting the date **FROM the server**, we convert it **from ISO to Local time**.  
Sending the date **TO the server**,  we convert it **from Local time to ISO**.  
Javascript does it all automatically.  
Just use `new Date(dateFromAPI)` then `date.toISOString()`

-----------------------------------------------------

### Use case \#2 ~ User has to edit the date, as it appears in England.

Now, user does not want to view/edit just any representation of the date, but instead, view and edit the date in UTC/GMT \(as it appears in England\). This may happen if your platform is a global product, which people access from multiple time-zones. 

Generally it would be fine to show each of them their Local time \(and convert it easily to ISO when saving in the Database\). Multiple people could still collaborate on the same date/time. They would just view it relative to their time-zone, but it would still represent the same time. If they edit the time relative to their timezone, it will still be converted to "world time" which is UTC/ISO.

But, lets say they all are collaborating on some time specific to England \(like when the London Stock Market opens, or some internal Business event is scheduled, in England\). 

**Back-end:** store date in UTC \(ISO\) in database.  
**Front-end:** display date in UTC \(GMT Local time\), allow user to edit the UTC \(GMT Local time\). 

Unfortunately, JS Date object can not be converted to any timezone other than the one the user's computer/browser is using. **So, we'll have to hack it.**  
[https://stackoverflow.com/questions/15141762/how-to-initialize-a-javascript-date-to-a-particular-time-zone](https://stackoverflow.com/questions/15141762/how-to-initialize-a-javascript-date-to-a-particular-time-zone)

```text
function visualizeUTC_asLocalTime(date) {
 return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds());  
}

// get date from server
const dateFromAPI = "2019-06-27T17:37:12.699Z";

// we can't edit the date in ISO format, need to convert to JS Date object
// unfortunately, JS Date Object always has a timezone, 
// and, we can't tell it to use the GMT timezone. It will use our PST!
const date = visualizeUTC_asLocalTime(new Date(dateFromAPI));
```

Now, our front-end will show the day/hour as if we were in England, but the Date object will still think we're in California timezone. The user will not see this "California timezone", so the UI will work. But, we'll have to remember later to convert it backwards, undo\_visualizeUTC\_asLocalTime\(\). Because if we fail to undo our previous transformation, and simply do `ourDate.toISOString()`, then the date will have been flown from California to England twice, but converted from England to California only once.

```text
function undo_visualizeUTC_asLocalTime(date) {
 return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(),  date.getHours(), date.getMinutes(), date.getSeconds()));
}

// send back to server
const postData = {
    date: undo_visualizeUTC_asLocalTime(date).toISOString()
}
```

So now it works, but only with the help of 2 functions. One to convert UTC &gt; Local. Another to convert Local &gt; UTC. Remember, that in JavaScript Date object, the timezone is always your Local time! So, even if you convert the date to UTC/GMT/England time, the timezone will still say "Pacific Standard Time" or wherever your are.

-----------------------------------------------------



