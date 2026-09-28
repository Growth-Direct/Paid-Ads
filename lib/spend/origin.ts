/** Where a spend number actually came from.
 *
 *  Carried on the ingest report rather than inferred, because the note under the Target vs
 *  Achieved table names the source in words. Inferring it — from a null slashOrder, say — would
 *  put a guess into a sentence the growth team reads as fact, and the guess would be wrong in
 *  exactly the case that matters: a ledger read that returned nothing looks like a snapshot
 *  that returned nothing. */
export type SpendOrigin = 'ledger' | 'snapshot' | 'sheet-live'
