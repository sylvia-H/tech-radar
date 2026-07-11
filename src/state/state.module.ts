import { Module } from '@nestjs/common';
import { StateStore, DEFAULT_STATE_PATH } from './state.store';

@Module({
  providers: [
    {
      provide: StateStore,
      useFactory: () => new StateStore(DEFAULT_STATE_PATH),
    },
  ],
  exports: [StateStore],
})
export class StateModule {}
