# decision-learning-loop

The system SHALL implement a formal decision learning loop using:

- `HumanReviewFeedback`
- `EvidenceRequest`
- `RetrospectiveCase`
- `LearningMemory`

The system SHALL distinguish:

- wrong judgment
- insufficient evidence
- wrong timing or priority
- evidence not currently available

#### Scenario: Human rejects with structured reason

- **GIVEN** a review meeting rejects or defers a decision object
- **WHEN** the human provides structured feedback
- **THEN** the system records `HumanReviewFeedback`
- **AND** may record one or more `EvidenceRequest`

The system SHALL treat evidence availability as a first-class status.

#### Scenario: Evidence is unavailable

- **GIVEN** a meeting requests supporting information
- **WHEN** the human indicates the information is unavailable now or unavailable in practice
- **THEN** the system records that availability state
- **AND** future meetings may use it to avoid repeatedly requesting the same unavailable input

The system SHALL only create `RetrospectiveCase` objects when a reopen rule or manual escalation indicates a historical decision should be reconsidered.

#### Scenario: Reopened rejection becomes retrospective case

- **GIVEN** a previously rejected or deferred decision object is later reactivated by new evidence or metrics
- **WHEN** reopen rules match
- **THEN** the system creates a `RetrospectiveCase`
- **AND** the retrospective may produce candidate learning memory

The system SHALL treat `LearningMemory` as bounded, revisable, and expirable policy memory rather than as a second general knowledge base.

#### Scenario: Learning memory is superseded

- **GIVEN** a new retrospective contradicts an active learning memory
- **WHEN** the system promotes the newer lesson
- **THEN** the old memory may be marked `superseded`
- **AND** the newer memory becomes the active policy guidance
