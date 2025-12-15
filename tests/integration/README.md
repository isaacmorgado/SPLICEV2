# Integration Tests

Integration tests for the Splice UXP Plugin are planned but not yet implemented.

The following areas need integration test coverage:
- Audio extraction → chunking → transcription flow
- Silence detection → cut application flow
- Error propagation through the pipeline
- Partial success scenarios

See tests/services/ and tests/lib/ for unit tests.
