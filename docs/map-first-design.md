# Map-first mobile design

Reference: [Magaalo Figma, Explore](https://www.figma.com/design/E7vZ3UmRtPabqO23aQP15I?node-id=9-5406).

The map stays behind floating search and category chips. Two primary controls expose layers and location; the city overview and satellite switch live inside Map details. A yellow report button remains above the bottom sheet. The home sheet opens compact with Home, Work and Saved; drag or tap its handle to reveal discovery and suggestions. Place cards prioritize Directions and put secondary information behind Details & suggestions.

DM Sans, the Figma palette, rounded surfaces and green maneuver banners are shared across screens. The live OpenStreetMap basemap uses subdued colors; its real cartography differs from the schematic streets in Figma. Existing saved basemap preferences are preserved; new installations default to Street. Existing users can select Street under Map details.

## Run and verify

1. Run `npm ci` and `npm start`, then open the app in the supported Expo development environment.
2. For browser layout review, run `npm run web`. The browser and native WebView share the same map document, with separate platform message bridges.
3. Check the compact and expanded sheet on a small phone, place selection, Directions, route alternatives and active navigation. Check large text and the keyboard on a physical device.
4. Switch English/Somali in Settings. New strings are in both JSON dictionaries and `corpus/en-so.tsv`; Somali copy still needs native-speaker review.
5. Run `npm run check`, `npm run lint`, and `npx expo export --platform android` before shipping.

Verified locally: TypeScript, bilingual key validation, Android/web bundle exports, and browser map rendering plus sheet expansion/collapse at 390×844. Lint has zero errors with existing hook/compiler diagnostics recorded as warnings in the scoped ESLint configuration. Physical-device GPS, voice guidance and authenticated report submission were not exercised in this design pass. Existing backend and database behavior is unchanged.
