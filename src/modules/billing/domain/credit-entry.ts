/**
 * Mouvement du portefeuille de crédits (ADR-0019 §10), en ajout seul :
 * achat (+), consommation par une conversion (−), remboursement d'une
 * conversion échouée (+). Le solde est tenu à jour dans la même transaction.
 */
export type CreditEntryKind = 'purchase' | 'consumption' | 'refund';
