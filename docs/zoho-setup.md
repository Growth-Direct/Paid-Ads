# Zoho CRM Setup

## Modules

### Products

Represents physical properties (apartments/houses) that Truva is mandated to sell.

**Key fields:**
| API Name | Purpose |
|----------|---------|
| `id` | Zoho record ID |
| `Product_Name` | Property name (e.g. "1311 - Wing C of Raj Infinia - 400064") |
| `Product_Category` | BHK type |
| `Truva_Micromarket` | Geographic area (Glasgow, Amsterdam, Powai, etc.) |
| `Truva_Cluster` | Cluster grouping (GLAM, PAV, BABU, HABIBI, VCV) |
| `Min_Guarantee` | Seller's minimum guarantee price (₹) |
| `Go_Live_Date` | Date property went live for selling |
| `Contract_End_Date` | End date of the seller mandate contract |
| `House_Captain` | Assigned owner/agent (lookup) |
| `Latest_Target_SP` | Latest target selling price (₹) |
| `Current_Offer_Cr` | Current offer in Cr |
| `Status` | Lifecycle status (see below) |
| `Buyer_MoU_Signing_Date` | Date buyer MoU was signed (marks end of "live" period) |
| `NPA_Date` | Date property became NPA (non-performing asset, no buyer MoU) |
| `Archetype_Score_v1` | Model likelihood score |

**Status picklist values:**

- `Live` — actively being sold
- `Acquired` — mandate signed but not yet live
- `Blocking Received` — buyer has paid blocking amount
- `Buyer Found` — buyer identified, MoU signed
- `Transaction Complete` — deal fully closed
- `Qualified` — property qualified but not yet mandated
- `Prospect` — early stage, being evaluated

### Deals (Bids)

Represents a buyer's interest/bid on a property. Each deal links to one Product via the `Products` lookup field.

**Key fields:**
| API Name | Purpose |
|----------|---------|
| `id` | Zoho record ID |
| `Deal_Name` | Format: "Lead Name (phone) \| Unit Property" |
| `Lead` | Lookup to Leads module (buyer) |
| `Stage` | Pipeline stage (see below) |
| `Lead_Source` | "Channel Partner" or "Direct" |
| `Was_Bid_Warm` | Boolean — was this bid ever warm |
| `Products` | Lookup to Products module |
| `Account_Name` | Channel partner company (if applicable) |
| `Likes` | Multi-select — features buyer liked |
| `Dislikes` | Multi-select — features buyer disliked |
| `Deal_Blocker` | Multi-select — what's blocking the deal |
| `Created_Time` | When the bid was created |

**Stage picklist values (pipeline order):**

- `Pre-Visit` — scheduled but hasn't visited yet
- `Active - Cold` — visited but not warm
- `Active - Warm` — showing strong interest
- `Offer Negotiation` — price negotiation in progress
- `Blocking Received` — blocking amount paid
- `Closed - Sold` — deal won
- `Closed - Won` — deal won (alternative label)
- `Closed - Rejected` — deal lost/cancelled
- `Cancelled` — bid cancelled

### Events (Visits/Meetings)

Represents a scheduled or completed property visit by a buyer.

**Key fields:**
| API Name | Purpose |
|----------|---------|
| `id` | Zoho record ID |
| `What_Id` | Lookup to the associated Deal (bid) |
| `Start_DateTime` | Visit date/time (IST, format: `YYYY-MM-DDTHH:mm:ss+05:30`) |
| `Visit_Status` | Completion status |

**Visit_Status values:**

- `Visit Complete` — visit happened (only these are counted in analytics)

**COQL notes:**

- `Start_DateTime` requires the `BETWEEN` operator for date range filtering (not `>=`)
- `Module` is a reserved keyword and cannot be used in WHERE clauses

### Leads

Represents a potential buyer.

**Key fields:**
| API Name | Purpose |
|----------|---------|
| `id` | Zoho record ID |
| `name` | Buyer's name |

### Notes

Attached to Events — contains visit feedback/observations.

**Key fields:**
| API Name | Purpose |
|----------|---------|
| `id` | Zoho record ID |
| `Note_Content` | HTML content (stripped to plain text for display) |
| `Parent_Id` | Lookup to the parent Event |
| `Created_Time` | When the note was created |

## Zoho URL Patterns

| Module   | URL Format                                  |
| -------- | ------------------------------------------- |
| Products | `https://crm.zoho.in/crm/tab/Products/{id}` |
| Deals    | `https://crm.zoho.in/crm/tab/Deals/{id}`    |
| Leads    | `https://crm.zoho.in/crm/tab/Leads/{id}`    |
| Events   | `https://crm.zoho.in/crm/tab/Events/{id}`   |

## Cluster → Micromarket Mapping

Derived dynamically from product data. Current known mapping:

| Cluster | Micromarkets                             |
| ------- | ---------------------------------------- |
| GLAM    | Glasgow, Amsterdam                       |
| PAV     | Powai, Athens, Vegas                     |
| BABU    | Barcelona, Boston, Singapore             |
| HABIBI  | Berlin, Helsinki, Hong Kong              |
| VCV     | Leaf Links (Virtual), Viceport (Virtual) |

Virtual micromarkets are excluded from all analytics in The Wire.

## Data Relationships

```
Event.What_Id → Deal.id
Deal.Products → Product.id
Deal.Lead → Lead.id
Note.Parent_Id → Event.id
```

A visit is counted when:

1. `Event.Visit_Status = 'Visit Complete'`
2. `Event.What_Id` resolves to a Deal
3. That Deal links to a Product with a non-virtual micromarket
