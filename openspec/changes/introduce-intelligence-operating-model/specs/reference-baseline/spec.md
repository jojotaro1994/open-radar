# reference-baseline

The system SHALL define a `Reference Baseline` as a first-class layer that stores product truth, capability boundaries, known limitations, terminology, and pricing/packaging constraints.

#### Scenario: Using reference to validate, not originate, intelligence

- **GIVEN** a new competitive or customer finding is being modeled
- **WHEN** the system checks it against the Reference Baseline
- **THEN** the baseline may validate, explain, constrain, or mark conflict
- **AND** the baseline SHALL NOT directly originate an opportunity decision by itself

The system SHALL allow a finding or decision object to be marked as conflicting with a reference fact without automatically rejecting it.

#### Scenario: High-value conflict with reference

- **GIVEN** new evidence contradicts the current product truth
- **WHEN** the system models the resulting finding
- **THEN** it records `conflictsWithReference`
- **AND** keeps the finding eligible for review and escalation
