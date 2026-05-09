# Job Naming Examples - Before & After

## Real-World Examples

### Example 1: Surpass GL Sync
**URL:** `https://surpass.alisonline.com/Settings/Billing/1069?tab=private`

**Before:**
```
Sync GL Accounts
5/9/2026, 6:33:21 PM
████████████████████████ 100%
```

**After:**
```
Sync GL Accounts - Surpass
5/9/2026, 6:33:21 PM
████████████████████████ 100%
```

---

### Example 2: Tarina of Stockton
**URL:** `https://tarina.alisonline.com/Settings/Billing/1234?tab=private`

**Before:**
```
Sync GL Accounts
5/9/2026, 6:28:20 PM
████████████████████████ 100%
```

**After:**
```
Sync GL Accounts - Tarina
5/9/2026, 6:28:20 PM
████████████████████████ 100%
```

---

### Example 3: Community Creation Job
**URL:** `https://acme.alisonline.com/`

**Before:**
```
Create 3 communities
5/9/2026, 5:45:00 PM
████████░░░░░░░░░░░░░░░░ 30%
```

**After:**
```
Create 3 communities - Acme
5/9/2026, 5:45:00 PM
████████░░░░░░░░░░░░░░░░ 30%
```

---

### Example 4: Multiple Jobs Same Company
When you run multiple jobs on the same company, they're now grouped by company name:

**Dashboard View (After):**
```
┌────────────────────────────────────────────┐
│ Sync GL Accounts - Surpass    [Completed]  │
│ 5/9/2026, 6:33:21 PM                      │
├────────────────────────────────────────────┤
│ Create 2 communities - Surpass [Completed] │
│ 5/9/2026, 6:30:00 PM                      │
├────────────────────────────────────────────┤
│ Sync GL Accounts - Tarina     [Completed]  │
│ 5/9/2026, 6:28:20 PM                      │
├────────────────────────────────────────────┤
│ Sync GL Accounts - Acme       [Running]    │
│ 5/9/2026, 6:45:30 PM                      │
└────────────────────────────────────────────┘

Easy to see:
- Two Surpass jobs (related work grouped)
- One Tarina job
- One Acme job running
```

---

## Naming Pattern Reference

### Pattern Format
```
[Job Template Name] - [Company Name]
```

### Common Patterns

**GL Account Sync:**
```
Sync GL Accounts - [Company]
Sync GL Accounts - Surpass
Sync GL Accounts - Tarina
Sync GL Accounts - Acme
```

**Community Creation:**
```
Create [X] communities - [Company]
Create 3 communities - Surpass
Create 5 communities - Tarina
```

**Custom Labels:**
```
[Custom Label] - [Company]
Q2 GL Migration - Surpass
Spring Cleanup - Acme
```

---

## URL-to-Company Mapping

### Standard Format
```
https://[COMPANY].alisonline.com/[rest of URL]
                 ↑
                 This part becomes the job label suffix
```

### Examples:

| URL | Company Name |
|-----|--------------|
| `https://surpass.alisonline.com/...` | Surpass |
| `https://tarina.alisonline.com/...` | Tarina |
| `https://acme.alisonline.com/...` | Acme |
| `https://mycompany.alisonline.com/...` | Mycompany |
| `https://the-company.alisonline.com/...` | The-company |
| `https://abc123.alisonline.com/...` | Abc123 |

**Capitalization:**
- First letter is always capitalized
- Rest of the characters maintain their original case
- Example: `mycompany` → `Mycompany`
- Example: `My-Company` → `My-company`

---

## Edge Cases

### Case 1: Already Has Company Name
If you provide a custom label that already includes the company name:

**Input:**
```
Label: "Q2 GL Sync - Surpass"
URL: https://surpass.alisonline.com/...
```

**Result:**
```
Q2 GL Sync - Surpass
(No duplicate appending)
```

---

### Case 2: No URL Provided
If the payload doesn't have a URL field:

**Input:**
```
Label: "Sync GL Accounts"
Payload: { items: [...] }  // No billingSettingsUrl
```

**Result:**
```
Sync GL Accounts
(Original label, no change)
```

---

### Case 3: Invalid URL
If the URL format is invalid:

**Input:**
```
Label: "Sync GL Accounts"
URL: "not-a-valid-url"
```

**Result:**
```
Sync GL Accounts
(Original label, no change)
```

---

## Historical Job Examples

Assuming these jobs were created today with the new naming:

### Completed Jobs
```
Sync GL Accounts - Surpass        [Completed]
Created: 5/9/2026, 6:33 PM
17/17 items completed ✓

Create 2 communities - Surpass    [Completed]
Created: 5/9/2026, 6:30 PM
2/2 items completed ✓

Sync GL Accounts - Tarina         [Completed]
Created: 5/9/2026, 6:28 PM
9/9 items completed ✓ (1 failed)
```

### Running Job
```
Sync GL Accounts - Acme           [Running]
Created: 5/9/2026, 6:45 PM
9/20 items completed [████████░░░░░░░░░░░░░░] 45%
```

---

## How It Helps

### Before (Confusing)
```
Sync GL Accounts    5/9/2026, 6:33 PM
Sync GL Accounts    5/9/2026, 6:28 PM
Sync GL Accounts    5/9/2026, 6:00 PM
Create 5 communities 5/9/2026, 5:45 PM
Sync GL Accounts    5/9/2026, 4:30 PM
```
*Which company is each job for? Need to click each one to find out.*

### After (Clear)
```
Sync GL Accounts - Surpass      5/9/2026, 6:33 PM
Sync GL Accounts - Tarina       5/9/2026, 6:28 PM
Sync GL Accounts - Acme         5/9/2026, 6:00 PM
Create 5 communities - Surpass  5/9/2026, 5:45 PM
Sync GL Accounts - Mycompany    5/9/2026, 4:30 PM
```
*Immediately clear which company each job is for. Much better!*

---

## Testing Your URLs

### Quick Test Format
```
URL: https://[COMPANY].alisonline.com/Settings/Billing/1234?tab=private

Extracted Company: [COMPANY] with first letter capitalized
Expected Job Label: [Template Name] - [Company]
```

### Try These:
1. `https://surpass.alisonline.com/Settings/Billing/1069?tab=private`
   - Expected: `Sync GL Accounts - Surpass` ✓

2. `https://tarina.alisonline.com/Settings/Billing/2345`
   - Expected: `Sync GL Accounts - Tarina` ✓

3. `https://acme.alisonline.com/Settings/Billing/5678`
   - Expected: `Sync GL Accounts - Acme` ✓

4. `https://test-company.alisonline.com/`
   - Expected: `Create Communities - Test-company` ✓

---

## Tips for Best Results

✅ **Do's:**
- Use standard URL format with company subdomain
- Include the full URL when creating jobs
- Use meaningful company names in subdomains
- Use consistent subdomain naming across your ALIS instance

❌ **Don'ts:**
- Don't use URLs without company subdomains
- Don't manually change the company name portion
- Don't use invalid URL formats
- Don't assume the company name will appear if URL is malformed

---

## Future Improvements

Once this feature is working well, we can add:
- Ability to override extracted company name
- Company name as separate searchable field
- Group jobs by company on dashboard
- Company-specific job history
- Company name badges with colors
- Custom company display names
