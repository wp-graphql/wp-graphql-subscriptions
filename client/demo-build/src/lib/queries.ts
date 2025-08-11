import { gql } from '@apollo/client';

export const POST_UPDATED_SUBSCRIPTION = gql`
  subscription PostUpdated($id: ID!) {
    postUpdated(id: $id) {
      id
      title
      status
      content
      date
      modified
      author {
        node {
          id
          name
        }
      }
    }
  }
`;

export interface PostUpdatedData {
  postUpdated: {
    id: string;
    title: string;
    status: string;
    content: string;
    date: string;
    modified: string;
    author: {
      node: {
        id: string;
        name: string;
      };
    };
  };
}

export interface PostUpdatedVars {
  id: string;
}